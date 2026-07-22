python3 - <<'PY'
p='src/game/sling.ts'
s=open(p).read()
s=s.replace("""// Дальность выстрела в пикселях. Считается от РАЗМЕРА ЭКРАНА: одинаковый натяг на
// планшете уносит карту не так далеко относительно стола, как на телефоне, — поэтому
// «недолёт» вообще существует как исход.
export function shotReach(power: number, screenDiag: number): number {
  return screenDiag * (0.25 + 0.95 * Math.max(0, Math.min(1, power)));
}""",
"""// Дальность выстрела в пикселях, и считается она от НАТЯГА, а не от размера экрана.
// Это и создаёт «недолёт»: на большом экране места сидят дальше в пикселях, поэтому тот
// же самый натяг пальцем до них уже не дотягивается. Полный натяг (maxPull задаёт движок
// от размера экрана) добивает через весь стол.
export const REACH_FACTOR = 7;

export function shotReach(pullLen: number): number {
  return Math.max(0, pullLen) * REACH_FACTOR;
}""")
open(p,'w').write(s)

p='src/game/sling.test.ts'
s=open(p).read()
s=s.replace("""  it("карта летит ровно против натяга: тянешь вниз — летит вверх", () => {
    expect(shotAngle({ x: 0, y: 100 })).toBeCloseTo(-Math.PI / 2, 6);
    expect(shotAngle({ x: 100, y: 0 })).toBeCloseTo(Math.PI, 6);
  });""",
"""  it("карта летит ровно против натяга: тянешь вниз — летит вверх", () => {
    expect(shotAngle({ x: 0, y: 100 })).toBeCloseTo(-Math.PI / 2, 6);
    // Тянешь вправо — летит влево (угол ±π — одно и то же направление).
    const left = shotAngle({ x: 100, y: 0 });
    expect(Math.cos(left)).toBeCloseTo(-1, 6);
    expect(Math.sin(left)).toBeCloseTo(0, 6);
  });""")
s=s.replace("""describe("shotReach / reaches", () => {
  it("дальность растёт с натягом", () => {
    expect(shotReach(1, 1000)).toBeGreaterThan(shotReach(0.5, 1000));
  });

  it("тот же натяг на БОЛЬШОМ экране не долетает, на маленьком — долетает", () => {
    const target = { x: 100, y: 100 }; // 400px от точки выстрела
    const power = 0.45;
    const smallScreen = shotReach(power, 700);
    const bigScreen = shotReach(power, 2400);
    // Дальность считается в долях экрана, поэтому на большом экране те же 400px ближе.
    expect(reaches(from, target, smallScreen)).toBe(false);
    expect(reaches(from, target, bigScreen)).toBe(true);
  });
});""",
"""describe("shotReach / reaches", () => {
  it("дальность растёт с натягом", () => {
    expect(shotReach(120)).toBeGreaterThan(shotReach(60));
    expect(shotReach(0)).toBe(0);
  });

  it("слабый натяг добивает до близкого места и НЕ добивает до далёкого", () => {
    // Это и есть «недолёт на большом экране»: дальность в пикселях, а места на крупном
    // столе сидят дальше — тот же жест пальцем до них уже не дотягивается.
    const weak = shotReach(40); // 280px
    expect(reaches(from, { x: 100, y: 300 }, weak)).toBe(true); // 200px — близко
    expect(reaches(from, { x: 100, y: 60 }, weak)).toBe(false); // 440px — далеко
  });
});""")
open(p,'w').write(s)
PY
npx vitest run src/game/sling.test.ts 2>&1|grep -E "Tests|×"|head -4