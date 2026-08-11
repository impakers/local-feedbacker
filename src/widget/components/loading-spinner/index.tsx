import styles from "./styles.module.scss";

export interface LoadingSpinnerProps {
  message?: string;
}

export function LoadingSpinner({ message = "로딩 중..." }: LoadingSpinnerProps) {
  return (
    <div className={styles.container}>
      <div className={styles.spinner} />
      <span className={styles.message}>{message}</span>
    </div>
  );
}
