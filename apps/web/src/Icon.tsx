import React from "react";
const paths = {
  pointer: "m6 4 12 9-6 1-3 6L6 4Z",
  translate: "M12 3v18M3 12h18M9 6l3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3",
  rotate: "M19 10a7 7 0 1 0 0 5m0-10v5h-5",
  scale: "M5 5h14v14H5Zm0 9v5h5m4-14h5v5M8 16l8-8",
  settings: "M4 7h16M4 12h16M4 17h16M8 5v4m8 1v4m-6 1v4",
  light: "M9 16c0-2-3-3-3-7a6 6 0 1 1 12 0c0 4-3 5-3 7m-6 2h6m-5 3h4",
  camera: "M3 7h12v10H3Zm12 3 6-3v10l-6-3",
  grid: "M4 4h6v6H4Zm10 0h6v6h-6ZM4 14h6v6H4Zm10 0h6v6h-6Z",

  cube: "M12 3 3 8v9l9 5 9-5V8l-9-5Zm0 0v10m-9-5 9 5 9-5m-9 5v9",
  folder: "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z",
  plus: "M12 5v14M5 12h14",
  undo: "M8 4 3 9l5 5M3 9h10a7 7 0 0 1 7 7v3",
  redo: "m16 4 5 5-5 5m5-5H11a7 7 0 0 0-7 7v3",
  open: "M3 8V6h7l2 2h9v3M3 8v12h15l4-9H7l-4 9",
  export: "M12 15V3m-4 4 4-4 4 4M4 14v6h16v-6",
  duplicate: "M8 8h13v13H8V8ZM3 16V3h13",
  trash: "M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6m4-6v6",
  circle: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
};
export function Icon({
  name,
  className = "",
}: {
  name: keyof typeof paths;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
