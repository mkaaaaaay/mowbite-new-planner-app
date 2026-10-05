import type {MowerMap} from '@/hooks/useMowerMap';
import {fmt, tr} from '@/lib/i18n';
import type {Problem} from '@/lib/mapCheck';
import type {Narrow} from '@/lib/narrowPassages';
import styles from './page.module.css';

type Shown = Problem | Narrow;

function text(p: Shown, map: MowerMap): string {
  switch (p.kind) {
    case 'crossing':
      return tr('the outline crosses itself (red on the map). The mower can plan wrong lanes there, pull the points apart.');
    case 'points':
      return tr("has fewer than 3 points, that's no area.");
    case 'dock':
      return tr(
        "The point {m} m in front of the docking station, where the mower heads for before docking, lies outside every active mowing and navigation area (red on the map). It can't get there, docking fails.",
        {m: fmt(p.distance, 1)},
      );
    case 'outside':
      return tr('lies outside every active mowing and navigation area and has no effect there.');
    case 'narrow': {
      const other = map.areas.find((a) => a.id === p.otherId)?.properties.name || tr('unnamed');
      const cm = {gap: Math.round(p.gap * 100), need: Math.round(p.need * 100)};
      return p.edge
        ? tr(
            "the mower doesn't get through to the edge of {area} here (red on the map): {gap} cm between the lines, it needs about {need} cm. Move the obstacle away, or grass stays standing there.",
            {area: other, ...cm},
          )
        : tr(
            "the mower doesn't get through between it and {other} here (red on the map): {gap} cm between the lines, it needs about {need} cm. Move one of them away, or grass stays standing there.",
            {other, ...cm},
          );
    }
  }
}

// what lib/mapCheck and lib/narrowPassages found in the map shown, a click on a name selects that area
export default function Problems({problems, map, onSelect}: {problems: Shown[]; map: MowerMap; onSelect: (id: string) => void}) {
  if (!problems.length) return null;
  const line = (p: Shown, i: number) => {
    if (!('areaId' in p)) return <li key={i}>{text(p, map)}</li>;
    const name = map.areas.find((a) => a.id === p.areaId)?.properties.name || tr('unnamed');
    return (
      <li key={i}>
        <a onClick={() => onSelect(p.areaId)}>{name}</a>: {text(p, map)}
      </li>
    );
  };
  const warn = problems.filter((p) => p.level === 'warn');
  const hints = problems.filter((p) => p.level === 'hint');
  return (
    <>
      {warn.length > 0 && (
        <div className={styles.warning}>
          <ul className={styles.problems}>{warn.map(line)}</ul>
        </div>
      )}
      {hints.length > 0 && <ul className={[styles.problems, styles.dim].join(' ')}>{hints.map(line)}</ul>}
    </>
  );
}
