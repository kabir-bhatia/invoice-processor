import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, ImageUp, Loader2, X } from "lucide-react";
import { api } from "../api";
import { cx } from "../lib/format";
import { checkPhoto, type PhotoQuality } from "../lib/quality";

type Phase = "starting" | "camera" | "nocamera" | "review" | "uploading";

const ISSUE: Record<NonNullable<PhotoQuality["issue"]>, { title: string; tip: string }> = {
  no_document: { title: "No invoice in view. Retake?", tip: "Fill the frame with the whole page, flat and face up." },
  blurry: { title: "Blurry. Retake?", tip: "Hold steady and tap when the text looks sharp." },
  dark: { title: "Too dark. Retake?", tip: "Move to better light or turn on a lamp." },
  glare: { title: "Glare on the page. Retake?", tip: "Tilt the page away from the light." },
};

export function Scan() {
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [shot, setShot] = useState<{ blob: Blob; url: string; q: PhotoQuality } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setPhase("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera api");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("camera");
    } catch {
      setPhase("nocamera");
    }
  }, []);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const q = checkPhoto(c, c.width, c.height);
    c.toBlob((blob) => {
      if (!blob) return;
      stop();
      setShot({ blob, url: URL.createObjectURL(blob), q });
      setPhase("review");
    }, "image/jpeg", 0.9);
  }

  async function fromFile(file: File) {
    try {
      const bmp = await createImageBitmap(file);
      const q = checkPhoto(bmp, bmp.width, bmp.height);
      stop();
      setShot({ blob: file, url: URL.createObjectURL(file), q });
      setPhase("review");
    } catch {
      // Not decodable in the browser (e.g. HEIC on some devices): let the server check it.
      stop();
      setShot({ blob: file, url: "", q: { sharpness: 0, brightness: 0, glare: 0, paper: 0, edges: 0, colour: 0, issue: null, ok: true } });
      setPhase("review");
    }
  }

  async function use() {
    if (!shot) return;
    setPhase("uploading");
    setError(null);
    try {
      const r = await api.uploadInvoice(shot.blob, "camera", "capture.jpg");
      nav(`/invoices/${r.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setPhase("review");
    }
  }

  function retake() {
    setShot(null);
    void start();
  }

  const q = shot?.q;
  const bad = q && !q.ok;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#101214] text-white">
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <button onClick={() => { stop(); nav(-1); }} aria-label="Close" className="grid size-11 place-items-center rounded-full hover:bg-white/10">
          <X className="size-6" />
        </button>
        <span className="text-[15px] font-medium">{phase === "review" || phase === "uploading" ? "Check the photo" : "Scan invoice"}</span>
        <span className="size-11" />
      </div>

      <div className="relative min-h-0 flex-1">
        {/* Live camera */}
        <video ref={videoRef} playsInline muted className={cx("absolute inset-0 size-full object-cover", phase !== "camera" && "invisible")} />
        {phase === "camera" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <div className="relative aspect-[1/1.414] max-h-full w-full max-w-sm rounded-xl shadow-[0_0_0_100vmax_rgb(0_0_0/0.45)]">
              {["top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-xl", "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-xl", "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-xl", "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-xl"].map((c) => (
                <span key={c} className={cx("absolute size-8 border-white", c)} />
              ))}
            </div>
            <p className="absolute bottom-4 rounded-full bg-black/55 px-3 py-1.5 text-[13px]">Fit the whole page inside the frame</p>
          </div>
        )}

        {phase === "starting" && (
          <div className="absolute inset-0 grid place-items-center text-white/70"><Loader2 className="size-7 animate-spin" /></div>
        )}

        {phase === "nocamera" && (
          <div className="absolute inset-0 grid place-items-center p-8 text-center">
            <div>
              <p className="text-lg font-semibold">Camera isn’t available</p>
              <p className="mx-auto mt-1.5 max-w-xs text-sm text-white/65">Allow camera access for this site, or pick a photo instead.</p>
              <button onClick={() => fileRef.current?.click()} className="mt-6 inline-flex h-12 items-center gap-2 rounded-control bg-white px-5 font-semibold text-ink">
                <ImageUp className="size-5" /> Take or choose a photo
              </button>
            </div>
          </div>
        )}

        {/* Review */}
        {(phase === "review" || phase === "uploading") && shot && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            {shot.url ? <img src={shot.url} alt="Captured invoice" className="max-h-full max-w-full rounded-lg object-contain" /> : <p className="text-white/70">Preview not available for this file</p>}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="safe-bottom shrink-0">
        {phase === "camera" && (
          <div className="grid h-28 grid-cols-3 items-center px-6">
            <button onClick={() => fileRef.current?.click()} aria-label="Choose a photo" className="grid size-12 place-items-center justify-self-start rounded-full bg-white/10">
              <ImageUp className="size-5" />
            </button>
            <button onClick={capture} aria-label="Take photo" className="grid size-[4.5rem] place-items-center justify-self-center rounded-full border-4 border-white/40 active:scale-95">
              <span className="size-14 rounded-full bg-white" />
            </button>
          </div>
        )}

        {(phase === "review" || phase === "uploading") && q && (
          <div className="animate-rise rounded-t-2xl bg-surface px-4 pt-4 pb-4 text-ink">
            <div className="flex items-start gap-3">
              <span className={cx("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", bad ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
                {bad ? <AlertTriangle className="size-4" /> : <Check className="size-4" strokeWidth={2.6} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">{bad ? ISSUE[q.issue!].title : "Page looks clear"}</p>
                <p className="text-[13px] text-ink-2">{bad ? ISSUE[q.issue!].tip : "Document found · sharp · well lit."}</p>
              </div>
            </div>
            {shot?.url && (
              <div className="mt-3.5 grid grid-cols-3 gap-3">
                <Meter label="Sharpness" value={q.sharpness} bad={q.issue === "blurry"} />
                <Meter label="Light" value={q.brightness} bad={q.issue === "dark"} />
                <Meter label="Glare" value={Math.min(1, q.glare * 4)} bad={q.issue === "glare"} invert />
              </div>
            )}
            {error && <p className="mt-3 text-[13px] text-risk">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={retake} disabled={phase === "uploading"} className={cx("h-12 flex-1 rounded-control border font-semibold disabled:opacity-50", bad ? "border-transparent bg-accent text-white" : "border-line-strong bg-surface")}>
                Retake
              </button>
              <button onClick={() => void use()} disabled={phase === "uploading"} className={cx("flex h-12 flex-1 items-center justify-center gap-2 rounded-control border font-semibold disabled:opacity-70", bad ? "border-line-strong bg-surface" : "border-transparent bg-accent text-white")}>
                {phase === "uploading" && <Loader2 className="size-4 animate-spin" />}
                {bad ? "Use anyway" : "Use photo"}
              </button>
            </div>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void fromFile(f); e.target.value = ""; }} />
    </div>
  );
}

function Meter({ label, value, bad, invert }: { label: string; value: number; bad: boolean; invert?: boolean }) {
  const good = invert ? "Low" : "Good";
  const poor = invert ? "High" : "Low";
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-3">{label}</span>
        <span className={cx("font-medium", bad ? "text-warn" : "text-ink-2")}>{bad ? poor : good}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
        <div className={cx("h-full rounded-full", bad ? "bg-warn" : "bg-ok/70")} style={{ width: `${Math.max(6, Math.round(value * 100))}%` }} />
      </div>
    </div>
  );
}
