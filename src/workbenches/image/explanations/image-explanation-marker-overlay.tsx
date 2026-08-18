import type { ImageExplanationView } from './shared';

export interface ImageExplanationScreenMarker {
  readonly explanation: ImageExplanationView;
  readonly number: number;
  readonly points?: string;
  readonly markerPosition?: { readonly x: number; readonly y: number };
}

export function ImageExplanationMarkerOverlay({
  visible,
  markers,
  selectedPolygon,
  onActivate,
}: {
  readonly visible: boolean;
  readonly markers: readonly ImageExplanationScreenMarker[];
  readonly selectedPolygon?: string;
  readonly onActivate: (explanation: ImageExplanationView) => void;
}) {
  return (
    <svg aria-label="图片兴趣区域标记" className="pointer-events-none absolute inset-0 z-[5] size-full overflow-visible">
      {visible && markers.map(({ explanation, number, points, markerPosition }) => points ? (
        <g
          key={explanation.id}
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onClick={() => onActivate(explanation)}
        >
          <polygon
            data-explanation-marker={explanation.id}
            points={points}
            fill={explanation.status === 'completed' ? 'rgba(99,102,241,0.08)' : 'rgba(148,163,184,0.06)'}
            stroke={explanation.status === 'failed' ? '#fb7185' : explanation.status === 'pending' ? '#94a3b8' : '#a5b4fc'}
            strokeWidth="2"
            strokeDasharray={explanation.status === 'completed' ? undefined : '5 4'}
            vectorEffect="non-scaling-stroke"
          />
          {markerPosition && (
            <>
              <circle cx={markerPosition.x} cy={markerPosition.y} r="9" fill="#4f46e5" stroke="#c7d2fe" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <text x={markerPosition.x} y={markerPosition.y} fill="#eef2ff" fontSize="9" fontWeight="700" textAnchor="middle" dominantBaseline="central">{number}</text>
            </>
          )}
        </g>
      ) : null)}
      {selectedPolygon && (
        <polygon
          data-current-selection="true"
          points={selectedPolygon}
          fill="rgba(99,102,241,0.14)"
          stroke="#c7d2fe"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
