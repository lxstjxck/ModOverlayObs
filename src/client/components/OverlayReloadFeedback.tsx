import type { OverlayReloadStatus } from "../../shared/types";

export function OverlayReloadFeedback({ status, message }: { status: OverlayReloadStatus | null; message: string }) {
  if (!status && !message) return null;
  const text = message || (status?.state === "waiting"
    ? `Команда получена: ${status.received} из ${status.total}. Переподключились и получили состояние: ${status.reconnected} из ${status.total}.`
    : status?.state === "completed"
      ? `OBS Overlay переподключён и синхронизирован: ${status.reconnected} из ${status.total}.`
      : status?.state === "timed_out"
        ? `Время ожидания истекло. Команду получили ${status.received} из ${status.total}, переподключились ${status.reconnected}. Перезагрузите источник в OBS вручную.`
        : "");
  return <p className="lxst-muted" role={message || status?.state === "timed_out" ? "alert" : "status"}>{text}</p>;
}
