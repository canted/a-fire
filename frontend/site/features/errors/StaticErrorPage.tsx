import { Fragment } from "react";
import { appRoutes } from "../../../src/lib/appRoutes";
import styles from "./StaticErrorPage.module.css";

type StaticErrorPageProps = {
  statusCode: 400 | 404 | 406 | 422 | 500;
  title: string;
  message: string;
  detail?: string;
};

export function StaticErrorPage({ statusCode, title, message, detail }: StaticErrorPageProps) {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <p className={styles.eyebrow}>A Fire</p>
        <div className={styles.errorContent}>
          <p className={styles.status}>{statusCode}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.message}>{message}</p>
          {detail ? (
            <Fragment>
              <div className={styles.divider} />
              <p className={styles.detail}>{detail}</p>
            </Fragment>
          ) : null}
        </div>
        <div className={styles.recovery}>
          <p>
            Try going back to{" "}
            <a className={styles.link} href={appRoutes.home()}>
              {appRoutes.home()}
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
