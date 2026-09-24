import { Eye, EyeOff } from "lucide-react";
import type { OverlayElement } from "../../shared/types";
import { sortElements } from "../utils";

interface LayersPanelProps {
  title: string;
  elements: OverlayElement[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onToggle?: (id: string, visible: boolean) => void;
}

export function LayersPanel({ title, elements, selectedId, onSelect, onToggle }: LayersPanelProps) {
  return (
    <section className="layers-panel">
      <div className="panel-title">
        <span>{title}</span>
      </div>
      <div className="layers-list">
        {sortElements(elements)
          .reverse()
          .map((element) => (
            <button
              key={element.id}
              className={`layer-row ${selectedId === element.id ? "active" : ""}`}
              type="button"
              onClick={() => onSelect(element.id)}
            >
              {element.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              <span>{element.name}</span>
              {onToggle && (
                <span
                  className="layer-toggle"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle(element.id, !element.visible);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onToggle(element.id, !element.visible);
                    }
                  }}
                >
                  {element.visible ? "on" : "off"}
                </span>
              )}
            </button>
          ))}
        {elements.length === 0 && <div className="empty-list">No layers</div>}
      </div>
    </section>
  );
}
