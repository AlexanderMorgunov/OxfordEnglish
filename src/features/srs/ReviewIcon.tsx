export function ReviewIcon({
  name,
}: {
  name: 'pause' | 'again' | 'hard' | 'good' | 'easy';
}) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'pause' ? (
        <>
          <path d="M8 5v14M16 5v14" />
        </>
      ) : name === 'again' ? (
        <>
          <path d="M3 10a9 9 0 1 1 2 9M3 4v6h6" />
        </>
      ) : name === 'hard' ? (
        <>
          <path d="M6 19v-4m6 4V9m6 10V5" />
        </>
      ) : name === 'good' ? (
        <>
          <path d="m5 12 4 4L19 6" />
        </>
      ) : (
        <>
          <path d="M3 18h18M5 22h14M7 15a5 5 0 0 1 10 0M12 3v3M4.5 7.5l2 2m11-2-2 2" />
        </>
      )}
    </svg>
  );
}
