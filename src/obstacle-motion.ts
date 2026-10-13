export type AnimalWaypoint = { time: number; x: number };
export const OBSTACLE_LANES = [-2.1, 0, 2.1] as const;

// Build once per trip so physics and interpolated rendering follow the same route.
export function createAnimalRoute(random = Math.random): AnimalWaypoint[] {
  const route: AnimalWaypoint[] = [{ time: 0, x: (random() * 2 - 1) * 2.3 }];
  let direction = random() < .5 ? -1 : 1;
  while (route[route.length - 1].time < 180) {
    const last = route[route.length - 1];
    const edge = direction * 2.65;
    const distance = Math.abs(edge - last.x);
    // 45% chance of turning early, provided there is room for a visible walk.
    const travel = random() < .45 && distance > .8
      ? .6 + random() * (distance - .6) * .8 : distance;
    const speed = .9 + random() * .7;
    route.push({ time: last.time + travel / speed, x: last.x + direction * travel });
    direction *= -1;
  }
  return route;
}

export function sampleAnimalRoute(route: AnimalWaypoint[], time: number) {
  let index = 1;
  while (index < route.length - 1 && route[index].time <= time) index++;
  const start = route[index - 1], end = route[index];
  const fraction = Math.max(0, Math.min(1, (time - start.time) / (end.time - start.time)));
  const vx = (end.x - start.x) / (end.time - start.time);
  return { x: start.x + (end.x - start.x) * fraction, vx, direction: Math.sign(vx) };
}
