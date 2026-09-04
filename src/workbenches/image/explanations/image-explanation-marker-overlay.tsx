import type { ImageExplanationView } from './shared';
import { layoutImageMarkerPositions } from './image-marker-layout';
import type { ImageMarkerViewport } from './image-marker-layout';
import { IMAGE_MARKER_VISUAL_STYLES } from './image-marker-style';

export interface ImageExplanationScreenMarker {
  readonly explanation: ImageExplanationView;
  readonly number: number;
  readonly points?: string;
  readonly markerPosition?: { readonly x: number; readonly y: number };
}

function ExplanationMarker({
  marker: { explanation, number, points, markerPosition },
  badgePosition,
  onActivate,
}: {
  readonly marker: ImageExplanationScreenMarker;
  readonly badgePosition?: { readonly x: number; readonly y: number };
  readonly onActivate: (explanation: ImageExplanationView) => void;
}) {
  if (!points) return null;
  const visualStyle =
    IMAGE_MARKER_VISUAL_STYLES[explanation.markerColor ?? 'blue'];
  const stroke =
    explanation.status === 'failed'
      ? '#fb7185'
      : explanation.status === 'pending'
        ? '#94a3b8'
        : visualStyle.stroke;
  const fill =
    explanation.status === 'completed'
      ? visualStyle.fill
      : 'rgba(148,163,184,0.06)';

  return (
    <g
      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
      onClick={() => onActivate(explanation)}
    >
      <polygon
        data-explanation-marker={explanation.id}
        points={points}
        fill={fill}
        stroke={stroke}
        strokeWidth="2"
        strokeDasharray={explanation.status === 'completed' ? undefined : '5 4'}
        vectorEffect="non-scaling-stroke"
      />
      {markerPosition && badgePosition && (
        <>
          {(badgePosition.x !== markerPosition.x ||
            badgePosition.y !== markerPosition.y) && (
            <line
              data-marker-leader={explanation.id}
              x1={markerPosition.x}
              y1={markerPosition.y}
              x2={badgePosition.x}
              y2={badgePosition.y}
              stroke={stroke}
              strokeWidth="1"
              strokeOpacity="0.75"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <circle
            data-marker-badge={explanation.id}
            cx={badgePosition.x}
            cy={badgePosition.y}
            r="9"
            fill={
              explanation.status === 'completed'
                ? visualStyle.badgeFill
                : stroke
            }
            stroke={
              explanation.status === 'completed'
                ? visualStyle.badgeStroke
                : '#e2e8f0'
            }
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={badgePosition.x}
            y={badgePosition.y}
            fill={
              explanation.status === 'completed'
                ? visualStyle.badgeText
                : '#f8fafc'
            }
            fontSize="9"
            fontWeight="700"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {number}
          </text>
        </>
      )}
    </g>
  );
}

export function ImageExplanationMarkerOverlay({
  visible,
  markers,
  selectedPolygon,
  viewportSize,
  onActivate,
}: {
  readonly visible: boolean;
  readonly markers: readonly ImageExplanationScreenMarker[];
  readonly selectedPolygon?: string;
  readonly viewportSize?: ImageMarkerViewport;
  readonly onActivate: (explanation: ImageExplanationView) => void;
}) {
  const markerLayout = new Map(
    layoutImageMarkerPositions(
      markers.flatMap(({ explanation, markerPosition }) =>
        markerPosition
          ? [{ id: explanation.id, preferredPosition: markerPosition }]
          : [],
      ),
      viewportSize,
    ).map(({ id, position }) => [id, position]),
  );
  return (
    <svg aria-label="图片兴趣区域标记" className="pointer-events-none absolute inset-0 z-[5] size-full overflow-visible">
      {visible && markers.map((marker) => (
        <ExplanationMarker
          key={marker.explanation.id}
          marker={marker}
          badgePosition={markerLayout.get(marker.explanation.id)}
          onActivate={onActivate}
        />
      ))}
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
