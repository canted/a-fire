import { Button } from "../../components/Button";
import styles from "./ClientBuildUpdateToast.module.css";

type ClientBuildUpdateToastProps = {
  onReload: () => void;
  onDismiss: () => void;
};

export function ClientBuildUpdateToast({ onReload, onDismiss }: ClientBuildUpdateToastProps) {
  return (
    <div className={styles.toast}>
      <div className={styles.title}>Update A Fire</div>
      <Button type="button" size="sm" color="ink" onClick={onReload}>
        Update
      </Button>
      <Button type="button" emphasis="ghost" size="sm" color="ink" onClick={onDismiss}>
        Later
      </Button>
    </div>
  );
}
