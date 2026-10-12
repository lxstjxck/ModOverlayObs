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
            <div
              key={element.id}
              className={`layer-row ${selectedId === element.id ? "active" : ""}`}
            >
              <button
                type="button"
                className="layer-select"
                onClick={() => onSelect(element.id)}
                aria-label={`Выбрать ${element.name}`}
              >
                {element.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                <span>{element.name}</span>
              </button>
              {onToggle && (
                <button
                  className="layer-toggle"
                  type="button"
                  aria-label={`${element.visible ? "Скрыть" : "Показать"} ${element.name}`}
                  onClick={() => onToggle(element.id, !element.visible)}
                >
                  {element.visible ? "on" : "off"}
                </button>
              )}
            </div>
          ))}
        {elements.length === 0 && (
          <div className="empty-list">Слои появятся после добавления объектов</div>
        )}
      </div>
    </section>
  );
}
