import styles from "./RouteFallback.module.css";

export function NotFound() {
  return (
    <div className={styles.page}>
      <p className={styles.title}>Page not found</p>
      <p className={styles.message}>Try another link or use the nav below.</p>
    </div>
  );
}
