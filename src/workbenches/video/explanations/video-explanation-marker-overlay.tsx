import type { VideoFrameRegionTarget } from '../shared';
import type { VideoExplanationView } from './shared';

export interface VideoExplanationMarker {
  readonly explanation: VideoExplanationView;
  readonly number: number;
}

function markerTone(explanation: VideoExplanationView): string {
  if (explanation.status === 'failed') {
    return 'border-rose-400 bg-rose-400/10';
  }
  if (explanation.status === 'pending') {
    return 'border-slate-400 bg-slate-300/[0.06] border-dashed';
  }
  return 'border-indigo-300 bg-indigo-400/[0.08]';
}

export function VideoExplanationMarkerOverlay({
  visible,
  markers,
  selectedTarget,
  onActivate,
}: {
  readonly visible: boolean;
  readonly markers: readonly VideoExplanationMarker[];
  readonly selectedTarget?: VideoFrameRegionTarget;
  readonly onActivate: (explanation: VideoExplanationView) => void;
}) {
  return (
    <div
      aria-label="视频兴趣区域标记"
      className="pointer-events-none absolute inset-0 z-[5]"
    >
      {visible &&
        markers.map(({ explanation, number }) => {
          const region = explanation.target.targetPayload;
          return (
            <button
              key={explanation.id}
              type="button"
              data-explanation-marker={explanation.id}
              aria-label={`打开视频标注 ${number}`}
              onClick={() => onActivate(explanation)}
              className={`pointer-events-auto absolute border-2 ${markerTone(explanation)}`}
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
            >
              <span className="absolute -left-2.5 -top-2.5 grid size-5 place-items-center rounded-full border border-indigo-200 bg-indigo-600 text-[9px] font-bold text-indigo-50 shadow-lg">
                {number}
              </span>
            </button>
          );
        })}
      {selectedTarget && (
        <div
          data-current-selection="true"
          className="absolute border-2 border-indigo-200 bg-indigo-400/10"
          style={{
            left: `${selectedTarget.targetPayload.x * 100}%`,
            top: `${selectedTarget.targetPayload.y * 100}%`,
            width: `${selectedTarget.targetPayload.width * 100}%`,
            height: `${selectedTarget.targetPayload.height * 100}%`,
          }}
        />
      )}
    </div>
  );
}
