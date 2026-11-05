import { Outlet } from "react-router-dom";
import { useEffect } from "react";
import { AnalyticsRouteTracker } from "../features/analytics/AnalyticsRouteTracker";
import { ClientBuildMonitor } from "../features/clientBuild/ClientBuildMonitor";
import { Toaster } from "../components/Toaster";
import styles from "./Shells.module.css";

export function SiteLayout() {
  useEffect(() => {
    document.body.classList.add(styles.siteBody);
    return () => document.body.classList.remove(styles.siteBody);
  }, []);

  return (
    <div className={styles.siteRoot} data-theme="site">
      <AnalyticsRouteTracker />
      <ClientBuildMonitor />
      <div className={styles.siteContent}>
        <Outlet />
      </div>
      <Toaster />
    </div>
  );
}
