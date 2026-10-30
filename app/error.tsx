"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main><h1>Something went wrong</h1><p role="alert">Please try again. Your saved todos have not been removed.</p><button onClick={reset}>Try again</button></main>;
}
