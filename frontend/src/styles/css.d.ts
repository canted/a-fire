declare module "*.module.css" {
  const styles: Record<string, string>;
  export default styles;
}

// Global token stylesheets are imported for their browser side effects.
declare module "*.css";
