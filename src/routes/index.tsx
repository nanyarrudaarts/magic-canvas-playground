import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Art Mail Club — Hover Animation" },
      {
        name: "description",
        content:
          "Animação de frames controlada pelo movimento do mouse, feita em Vanilla JavaScript e HTML5 Canvas.",
      },
      { property: "og:title", content: "Art Mail Club — Hover Animation" },
      {
        property: "og:description",
        content: "Animação de frames controlada pelo movimento do mouse em HTML5 Canvas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/hover/index.html"
      title="Hover-driven animation"
      className="block h-screen w-screen border-0"
    />
  );
}
