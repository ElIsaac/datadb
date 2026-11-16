import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptadorDeConsola, type FuenteDeTexto } from "./consola-adapter";
import { EditorModel } from "@/lib/editor-core/model";

function crearAdaptadorSobreModelo(textoInicial: string) {
  const model = new EditorModel(textoInicial);
  const fuente: FuenteDeTexto = {
    texto: () => model.text,
    seleccion: () => model.selection,
    aplicar: (from, to, insert) => {
      model.setSelection({ anchor: from, head: to });
      model.insert(insert);
    },
    enfocar: () => {},
    fijarSeleccion: (anchor, head) => {
      model.setSelection({ anchor, head });
    },
  };
  return {
    model,
    ...adaptadorDeConsola(fuente, () => null),
  };
}

test("dispatch con changes sin `to` inserta en `from` y deja la selección finita (no NaN)", () => {
  const { model, view } = crearAdaptadorSobreModelo("SELECT");
  view.dispatch({
    changes: { from: 6, insert: " * FROM users" },
  });

  assert.equal(model.text, "SELECT * FROM users");
  assert.ok(Number.isFinite(view.state.selection.main.anchor), "anchor debe ser finito");
  assert.ok(Number.isFinite(view.state.selection.main.head), "head debe ser finito");
  assert.equal(view.state.selection.main.anchor, 19);
  assert.equal(view.state.selection.main.head, 19);
});

test("dispatch con `from` y `to` reemplaza el rango exacto", () => {
  const { model, view } = crearAdaptadorSobreModelo("select * FROM users");
  view.dispatch({
    changes: { from: 0, to: 6, insert: "SELECT" },
  });

  assert.equal(model.text, "SELECT * FROM users");
  assert.equal(view.state.selection.main.anchor, 6);
  assert.equal(view.state.selection.main.head, 6);
});
