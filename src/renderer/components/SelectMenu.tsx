import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

export interface SelectMenuOption {
  readonly value: string;
  readonly label: string;
}

interface SelectMenuProps {
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: readonly SelectMenuOption[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly editable?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
}

interface MenuPosition {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly maxHeight: number;
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m3.5 8 3 3 6-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SelectMenu({
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  editable = false,
  placeholder = '请选择',
  className = '',
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition>();
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!open) {
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 4;
      const desiredHeight = Math.min(options.length * 34 + 12, 240);
      const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
      const spaceAbove = rect.top - gap - viewportPadding;
      const opensUp = spaceBelow < Math.min(desiredHeight, 120) && spaceAbove > spaceBelow;
      const availableSpace = opensUp ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(72, Math.min(desiredHeight, availableSpace));
      const width = rect.width;
      const left = Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - width - viewportPadding),
      );

      setPosition({
        top: opensUp ? Math.max(viewportPadding, rect.top - gap - maxHeight) : rect.bottom + gap,
        left,
        width,
        maxHeight,
      });
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !anchorRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnOutsideFocus = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !anchorRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    updatePosition();
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('focusin', closeOnOutsideFocus);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('focusin', closeOnOutsideFocus);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (disabled || options.length === 0) {
      const frame = window.requestAnimationFrame(() => setOpen(false));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [disabled, options.length]);

  const openAt = (index: number) => {
    if (options.length === 0) {
      setActiveIndex(-1);
      setOpen(false);
      return;
    }
    setActiveIndex(Math.max(0, Math.min(index, options.length - 1)));
    setOpen(true);
  };
  const focusControl = () => {
    if (editable) {
      inputRef.current?.focus();
    } else {
      buttonRef.current?.focus();
    }
  };
  const selectAt = (index: number) => {
    const option = options[index];
    if (!option) {
      return;
    }
    onChange(option.value);
    setOpen(false);
    focusControl();
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (disabled) {
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) {
        return;
      }
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) {
        openAt(
          selectedIndex >= 0
            ? selectedIndex
            : direction > 0
              ? 0
              : options.length - 1,
        );
        return;
      }
      const initialIndex =
        activeIndex >= 0 ? activeIndex : Math.max(selectedIndex, 0);
      openAt((initialIndex + direction + options.length) % options.length);
      return;
    }
    if (
      (event.key === 'Enter' || (!editable && event.key === ' ')) &&
      open
    ) {
      event.preventDefault();
      if (activeIndex >= 0) {
        selectAt(activeIndex);
      } else {
        setOpen(false);
      }
      return;
    }
    if (!editable && event.key === 'Home') {
      event.preventDefault();
      openAt(0);
      return;
    }
    if (!editable && event.key === 'End') {
      event.preventDefault();
      openAt(options.length - 1);
    }
  };

  const menuStyle: CSSProperties | undefined = position
    ? {
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }
    : undefined;
  const activeDescendant =
    open && activeIndex >= 0
      ? `${listboxId}-option-${activeIndex}`
      : undefined;

  return (
    <>
      <div ref={anchorRef} className={`relative ${className}`}>
        {editable ? (
          <div className="ui-control flex h-8 items-center rounded-lg border border-white/[0.08] bg-[#252a32] text-sm text-slate-300 focus-within:border-indigo-200/25">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label={ariaLabel}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              aria-activedescendant={activeDescendant}
              value={value}
              disabled={disabled}
              placeholder={placeholder}
              spellCheck={false}
              onFocus={() =>
                openAt(selectedIndex >= 0 ? selectedIndex : 0)
              }
              onClick={() =>
                openAt(selectedIndex >= 0 ? selectedIndex : 0)
              }
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange(nextValue);
                setActiveIndex(
                  options.findIndex((option) => option.value === nextValue),
                );
                if (options.length > 0) {
                  setOpen(true);
                }
              }}
              onKeyDown={handleKeyDown}
              className="h-full min-w-0 flex-1 bg-transparent px-2 outline-none placeholder:text-slate-600 disabled:opacity-45"
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={`${ariaLabel}候选项`}
              disabled={disabled || options.length === 0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (open) {
                  setOpen(false);
                } else {
                  openAt(selectedIndex >= 0 ? selectedIndex : 0);
                }
              }}
              className="grid h-full w-8 shrink-0 place-items-center text-slate-500 disabled:opacity-45"
            >
              <span
                className={`size-3 transition-transform duration-150 motion-reduce:transition-none ${
                  open ? 'rotate-180' : ''
                }`}
              >
                <ChevronDownIcon />
              </span>
            </button>
          </div>
        ) : (
          <button
            ref={buttonRef}
            type="button"
            aria-label={ariaLabel}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={activeDescendant}
            disabled={disabled || options.length === 0}
            onClick={() => {
              if (open) {
                setOpen(false);
              } else {
                openAt(selectedIndex >= 0 ? selectedIndex : 0);
              }
            }}
            onKeyDown={handleKeyDown}
            className="ui-control flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-[#252a32] px-2 text-left text-sm text-slate-300 disabled:opacity-45"
          >
            <span className="min-w-0 truncate">
              {selectedOption?.label ?? placeholder}
            </span>
            <span
              className={`size-3 shrink-0 text-slate-500 transition-transform duration-150 motion-reduce:transition-none ${
                open ? 'rotate-180' : ''
              }`}
            >
              <ChevronDownIcon />
            </span>
          </button>
        )}
      </div>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
            className="fixed z-[100] overflow-y-auto rounded-lg border border-white/[0.13] bg-[#292e36] p-1 shadow-[0_18px_44px_rgba(0,0,0,0.5)]"
          >
            {options.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;
              return (
                <button
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onPointerMove={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectAt(index)}
                  className={`ui-menu-item flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
                    selected
                      ? 'bg-indigo-300/12 text-indigo-100'
                      : active
                        ? 'bg-white/[0.07] text-slate-100'
                        : 'text-slate-300'
                  }`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  <span className={`size-3 shrink-0 ${selected ? 'text-indigo-200' : 'opacity-0'}`}>
                    <CheckIcon />
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
