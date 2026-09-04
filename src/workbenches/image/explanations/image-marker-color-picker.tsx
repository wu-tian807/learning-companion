import {
  IMAGE_MARKER_COLORS,
  IMAGE_MARKER_COLOR_LABELS,
  IMAGE_MARKER_COLOR_VALUES,
  type ImageMarkerColor,
} from './image-marker-style';

export function ImageMarkerColorPicker({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: ImageMarkerColor;
  readonly onChange: (color: ImageMarkerColor) => void;
  readonly disabled?: boolean;
}) {
  return (
    <fieldset aria-label="图片标注颜色" className="flex items-center gap-1.5">
      <legend className="sr-only">图片标注颜色</legend>
      {IMAGE_MARKER_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`${IMAGE_MARKER_COLOR_LABELS[color]}图片标注`}
          aria-pressed={value === color}
          disabled={disabled}
          onClick={() => onChange(color)}
          className={`size-5 rounded-full border shadow-sm transition-transform disabled:opacity-40 ${
            value === color
              ? 'scale-110 border-slate-200 ring-1 ring-slate-300/50'
              : 'border-white/20 hover:scale-105'
          }`}
          style={{ backgroundColor: IMAGE_MARKER_COLOR_VALUES[color] }}
          title={IMAGE_MARKER_COLOR_LABELS[color]}
        />
      ))}
    </fieldset>
  );
}
