// Markdown files are bundled into the bin as text (`import x from "./x.md" with { type: "text" }`).
declare module "*.md" {
  const text: string;
  export default text;
}
