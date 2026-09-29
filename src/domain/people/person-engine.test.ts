import { describe, expect, it } from "vitest";
import { archivePerson, createPerson, updatePerson } from "./person-engine";

describe("person engine", () => {
  it("creates a normalized active person", () => {
    const person = createPerson("  João   da Silva  ");
    expect(person.name).toBe("João da Silva");
    expect(person.active).toBe(true);
  });

  it("rejects duplicate active names", () => {
    const existing = { id: "1", name: "Maria", active: true };
    expect(() => createPerson(" maria ", { people: [existing] })).toThrow();
  });

  it("allows historical duplicate after the previous person is archived", () => {
    const existing = { id: "1", name: "Maria", active: false };
    expect(createPerson("Maria", { people: [existing] }).name).toBe("Maria");
  });

  it("archives without deleting", () => {
    const person = { id: "1", name: "Maria", active: true };
    expect(archivePerson(person)).toEqual({ id: "1", name: "Maria", active: false });
  });

  it("rejects duplicate on update", () => {
    const person = { id: "1", name: "Maria", active: true };
    const other = { id: "2", name: "João", active: true };
    expect(() => updatePerson(person, " João ", { people: [person, other] })).toThrow();
  });
});
