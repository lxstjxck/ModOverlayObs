const publicMetadata = {
  "/": {
    title: "LXST — инструменты для стримеров",
    description: "Экосистема инструментов LXST для стримеров и модераторов."
  },
  "/overlay": {
    title: "LXST Overlay — оверлей для OBS",
    description: "Управление медиа и интерактивным OBS-оверлеем с доступом для модераторов."
  }
} as const;

export function setPublicPageMetadata(path: string, page: Document): void {
  const metadata = publicMetadata[path as keyof typeof publicMetadata];
  if (!metadata) return;
  page.title = metadata.title;
  page.querySelector('meta[name="description"]')?.setAttribute("content", metadata.description);
}
