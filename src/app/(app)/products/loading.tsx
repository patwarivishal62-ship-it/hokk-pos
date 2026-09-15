export default function ProductsLoading() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="h-8 w-32 bg-ink-100 rounded" />
      <div className="h-24 bg-ink-100 rounded" />
      <div className="h-96 bg-ink-100 rounded" />
    </div>
  );
}
