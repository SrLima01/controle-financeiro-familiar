import type { EntityCollection } from "../../infrastructure/persistence/repository";
import type { Person } from "../types/entities";

function normalizedName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function createPerson(name: string, data?: Pick<EntityCollection, "people">): Person {
  const normalized = normalizedName(name);
  if (!normalized) throw new Error("Informe o nome da pessoa.");
  if (normalized.length > 80) throw new Error("O nome da pessoa deve ter no máximo 80 caracteres.");
  if (data?.people.some(p => p.active && p.name.trim().toLocaleLowerCase("pt-BR") === normalized.toLocaleLowerCase("pt-BR"))) {
    throw new Error("Já existe uma pessoa ativa com esse nome.");
  }
  return { id: crypto.randomUUID(), name: normalized, active: true };
}

export function updatePerson(person: Person, name: string, data: Pick<EntityCollection, "people">): Person {
  const normalized = normalizedName(name);
  if (!normalized) throw new Error("Informe o nome da pessoa.");
  if (normalized.length > 80) throw new Error("O nome da pessoa deve ter no máximo 80 caracteres.");
  if (data.people.some(p => p.id !== person.id && p.active && p.name.trim().toLocaleLowerCase("pt-BR") === normalized.toLocaleLowerCase("pt-BR"))) {
    throw new Error("Já existe outra pessoa ativa com esse nome.");
  }
  return { ...person, name: normalized, active: true };
}

export function archivePerson(person: Person): Person {
  return { ...person, active: false };
}
