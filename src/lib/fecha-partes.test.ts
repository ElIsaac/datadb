import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  aValorFecha,
  aValorFechaHora,
  conParte,
  diasDelMes,
  partesDeTexto,
  partesDeValor,
} from "./fecha-partes";

/* R95 — el editor de fecha partida (día ▾ · mes ▾ · año / hora · minuto · segundo), como DataGrip. */

describe("partesDeValor", () => {
  test("el valor de la captura del usuario se parte sin perder la fracción", () => {
    const p = partesDeValor("2026-10-21 03:19:00.000000");
    assert.deepEqual(p, { anio: 2026, mes: 10, dia: 21, hora: 3, minuto: 19, segundo: 0, fraccion: ".000000" });
    assert.equal(aValorFechaHora(p!), "2026-10-21 03:19:00.000000", "ida y vuelta sin tocar nada = mismo texto");
  });

  test("una fecha sola, con T, y lo que no es fecha", () => {
    assert.equal(aValorFecha(partesDeValor("2019-07-04")!), "2019-07-04");
    assert.equal(partesDeValor("2026-10-21T23:05:09")?.hora, 23);
    assert.equal(partesDeValor(null), null);
    assert.equal(partesDeValor("mañana"), null);
    assert.equal(partesDeValor("2026-02-30"), null);
  });
});

describe("conParte", () => {
  const base = partesDeValor("2026-01-31 10:00:00")!;

  test("cambiar el mes a febrero acota el día al último (nunca 31 de febrero ni 3 de marzo)", () => {
    assert.equal(aValorFecha(conParte(base, "mes", 2)), "2026-02-28");
    assert.equal(aValorFecha(conParte(conParte(base, "anio", 2024), "mes", 2)), "2024-02-29");
  });

  test("cada parte se queda en su rango", () => {
    assert.equal(conParte(base, "hora", 27).hora, 23);
    assert.equal(conParte(base, "minuto", -3).minuto, 0);
    assert.equal(conParte(base, "dia", 40).dia, 31);
    assert.equal(conParte(base, "mes", 13).mes, 12);
    assert.equal(conParte(base, "anio", Number.NaN), base, "un número inválido no cambia nada");
  });

  test("cambiar solo el año conserva lo demás (incluida la fracción)", () => {
    const p = conParte(partesDeValor("2026-10-21 03:19:00.000000")!, "anio", 2019);
    assert.equal(aValorFechaHora(p), "2019-10-21 03:19:00.000000");
  });

  test("diasDelMes con bisiestos", () => {
    assert.equal(diasDelMes(2024, 2), 29);
    assert.equal(diasDelMes(2025, 2), 28);
    assert.equal(diasDelMes(2026, 12), 31);
  });
});

describe("partesDeTexto", () => {
  const base = partesDeValor("2026-10-21 03:19:00")!;

  test("fecha y hora escritas", () => {
    assert.equal(aValorFechaHora(partesDeTexto("04/07/2019 18:30", true, base)!), "2019-07-04 18:30:00");
    assert.equal(aValorFechaHora(partesDeTexto("2019-07-04T18:30:15", true, base)!), "2019-07-04 18:30:15");
  });

  test("solo la fecha conserva la hora que ya tenía", () => {
    assert.equal(aValorFechaHora(partesDeTexto("2019-07-04", true, base)!), "2019-07-04 03:19:00");
  });

  test("lo imposible no se aplica", () => {
    assert.equal(partesDeTexto("31/02/2026", true, base), null);
    assert.equal(partesDeTexto("2026-10-21 25:00", true, base), null);
    assert.equal(partesDeTexto("2026-10-21 10:00", false, base), null, "una columna date no lleva hora");
    assert.equal(partesDeTexto("", true, base), null);
  });
});
