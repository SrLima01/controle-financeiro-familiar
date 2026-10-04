import type { Category } from "../types/entities";
import type { EntityCollection } from "../../infrastructure/persistence/repository";

export function createCategory(name:string,kind:Category["kind"],data?:Pick<EntityCollection,"categories">,emoji="🏷️"):Category{
 const normalized=name.trim().replace(/\s+/g," ");
 if(!normalized)throw new Error("Informe o nome da categoria.");
 if(normalized.length>60)throw new Error("A categoria deve ter no máximo 60 caracteres.");
 if(kind!=="INCOME"&&kind!=="EXPENSE")throw new Error("Tipo de categoria inválido.");
 const normalizedEmoji=emoji.trim();
 if(!normalizedEmoji)throw new Error("Escolha um emoji para a categoria.");
 if(normalizedEmoji.length>16)throw new Error("O emoji da categoria é inválido.");
 if(data?.categories.some(c=>c.active&&c.kind===kind&&c.name.trim().toLocaleLowerCase("pt-BR")===normalized.toLocaleLowerCase("pt-BR")))throw new Error("Já existe uma categoria ativa com esse nome e tipo.");
 return {id:crypto.randomUUID(),name:normalized,emoji:normalizedEmoji,kind,active:true};
}
export function updateCategory(category:Category,name:string,kind:Category["kind"],data:Pick<EntityCollection,"categories">,emoji=category.emoji??"🏷️"):Category{
 const normalized=name.trim().replace(/\s+/g," ");
 if(!normalized)throw new Error("Informe o nome da categoria.");
 if(normalized.length>60)throw new Error("A categoria deve ter no máximo 60 caracteres.");
 if(data.categories.some(c=>c.id!==category.id&&c.active&&c.kind===kind&&c.name.trim().toLocaleLowerCase("pt-BR")===normalized.toLocaleLowerCase("pt-BR")))throw new Error("Já existe outra categoria ativa com esse nome e tipo.");
 const normalizedEmoji=emoji.trim();
 if(!normalizedEmoji)throw new Error("Escolha um emoji para a categoria.");
 if(normalizedEmoji.length>16)throw new Error("O emoji da categoria é inválido.");
 return {...category,name:normalized,emoji:normalizedEmoji,kind,active:true};
}
export function archiveCategory(category:Category):Category{return {...category,active:false};}
