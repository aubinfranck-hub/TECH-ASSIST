import { Link } from 'react-router-dom';

interface Props {
  eyebrow: string;
  title: string;
  text: string;
  image: string;
  imageAlt: string;
  action?: { label: string; to: string };
  dark?: boolean;
}

export function PageHero({ eyebrow, title, text, image, imageAlt, action, dark = false }: Props) {
  return (
    <section className={`relative overflow-hidden ${dark ? 'bg-[#07101d] text-white' : 'bg-white'}`}>
      <div className="ta-container grid min-h-[320px] items-center gap-8 py-10 lg:grid-cols-[1.05fr_.95fr] lg:py-12">
        <div className="relative z-10 max-w-2xl">
          <p className={`text-xs font-extrabold uppercase tracking-[.16em] ${dark ? 'text-slate-300' : 'text-brand-700'}`}>{eyebrow}</p>
          <h1 className="mt-3 font-display text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl">{title}</h1>
          <p className={`mt-5 max-w-xl text-base leading-7 ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{text}</p>
          {action && <Link to={action.to} className="ta-button-primary mt-7">{action.label} →</Link>}
        </div>
        <div className="relative overflow-hidden rounded-[28px] shadow-2xl ring-1 ring-black/5">
          <img src={image} alt={imageAlt} className="h-64 w-full object-cover sm:h-72 lg:h-[330px]" loading="eager" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent" />
        </div>
      </div>
    </section>
  );
}
