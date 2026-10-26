const COLORS = ["#00f0ff", "#ff2bd6", "#3dff9a", "#ffcc33", "#8f7bff", "#ffffff"];
const PIECES = 18;

/** A one-shot burst of confetti around its parent's centre; the parent must be position: relative. */
export function Confetti() {
  return (
    <span className="confetti" aria-hidden>
      {Array.from({ length: PIECES }, (_, i) => {
        const angle = (i / PIECES) * Math.PI * 2;
        const dist = 60 + (i % 3) * 22;
        return (
          <i
            key={i}
            style={{
              ["--dx" as string]: `${Math.cos(angle) * dist}px`,
              ["--dy" as string]: `${Math.sin(angle) * dist - 20}px`,
              ["--r" as string]: `${(i * 47) % 360}deg`,
              color: COLORS[i % COLORS.length],
              animationDelay: `${(i % 4) * 30}ms`,
            }}
          />
        );
      })}
    </span>
  );
}
