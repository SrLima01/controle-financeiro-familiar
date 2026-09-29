import {describe,expect,it} from "vitest";
import {archiveCategory,createCategory,updateCategory} from "./category-engine";
describe("category engine",()=>{
 it("creates normalized category",()=>expect(createCategory("  Mercado   ","EXPENSE").name).toBe("Mercado"));
 it("rejects duplicate active category of same kind",()=>{const c={id:"1",name:"Mercado",kind:"EXPENSE" as const,active:true};expect(()=>createCategory(" mercado ","EXPENSE",{categories:[c]})).toThrow();});
 it("allows same name across different kinds",()=>{const c={id:"1",name:"Salário",kind:"INCOME" as const,active:true};expect(createCategory("Salário","EXPENSE",{categories:[c]}).kind).toBe("EXPENSE");});
 it("archives without deleting",()=>expect(archiveCategory({id:"1",name:"Mercado",kind:"EXPENSE",active:true})).toEqual({id:"1",name:"Mercado",kind:"EXPENSE",active:false}));
 it("rejects duplicate on update",()=>{const c={id:"1",name:"Mercado",kind:"EXPENSE" as const,active:true};const o={id:"2",name:"Farmácia",kind:"EXPENSE" as const,active:true};expect(()=>updateCategory(c,"Farmácia","EXPENSE",{categories:[c,o]})).toThrow();});
});
