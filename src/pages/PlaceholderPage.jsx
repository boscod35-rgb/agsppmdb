export default function PlaceholderPage({ label }) {
  return (
    <div className="page">
      <h1>{label || 'Module'}</h1>
      <div className="placeholder-box">
        <p>This module hasn&rsquo;t been built yet.</p>
        <p className="placeholder-detail">
          Coming in a future chunk, per the build order in Framework Section 101.
        </p>
      </div>
    </div>
  );
}
