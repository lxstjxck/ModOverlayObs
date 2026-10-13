export function PublicFooter({ product, description }: { product: string; description: string }) {
  return (
    <footer className="landing-footer landing-shell">
      <span>{product}</span>
      <span>{description}</span>
      <span className="landing-footer-developer">
        Created by lxstjxck <span aria-hidden="true">·</span>{" "}
        <a href="https://github.com/lxstjxck" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>{" "}
        <span aria-hidden="true">·</span>{" "}
        <a href="mailto:svjack69@gmail.com">Связаться</a>
      </span>
    </footer>
  );
}
