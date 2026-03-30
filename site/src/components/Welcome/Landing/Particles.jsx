import { useEffect, useRef } from "react";

const PALETTES = [
  { color: [200, 180, 255], glow: [180, 160, 255] }, // purple
  { color: [100, 200, 255], glow: [80, 180, 240] },  // cyan
  { color: [255, 180, 100], glow: [255, 160, 80] },  // amber
  { color: [120, 220, 160], glow: [100, 200, 140] }, // green
  { color: [255, 140, 180], glow: [240, 120, 160] }, // pink
  { color: [160, 140, 255], glow: [140, 120, 240] }, // indigo
  { color: [255, 200, 120], glow: [240, 180, 100] }, // gold
];

export default function Particles({ count = 30 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    const particles = [];

    // Pick 2-3 random colors for this page
    const shuffled = [...PALETTES].sort(() => Math.random() - 0.5);
    const colors = shuffled.slice(0, 2 + Math.floor(Math.random() * 2));

    function resize() {
      canvas.width = canvas.parentElement.offsetWidth;
      canvas.height = canvas.parentElement.offsetHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < count; i++) {
      const palette = colors[i % colors.length];
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.3,
        dx: (Math.random() - 0.5) * 0.25,
        dy: (Math.random() - 0.5) * 0.25,
        opacity: Math.random() * 0.4 + 0.15,
        pulse: Math.random() * Math.PI * 2,
        color: palette.color,
        glow: palette.glow,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scrollFade = Math.max(0, 1 - window.scrollY / (canvas.height * 0.8));

      for (const p of particles) {
        p.x += p.dx;
        p.y += p.dy;
        p.pulse += 0.01;

        if (p.x < -5) p.x = canvas.width + 5;
        if (p.x > canvas.width + 5) p.x = -5;
        if (p.y < -5) p.y = canvas.height + 5;
        if (p.y > canvas.height + 5) p.y = -5;

        const flicker = 0.7 + Math.sin(p.pulse) * 0.3;
        const alpha = p.opacity * flicker * scrollFade;
        if (alpha < 0.01) continue;

        const [cr, cg, cb] = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
        ctx.fill();

        if (p.r > 0.8) {
          const [gr, gg, gb] = p.glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${gr}, ${gg}, ${gb}, ${alpha * 0.15})`;
          ctx.fill();
        }
      }
      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [count]);

  return <canvas ref={ref} className="lp-particles" />;
}
