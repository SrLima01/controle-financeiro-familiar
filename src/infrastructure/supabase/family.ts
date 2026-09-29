import { requireSupabase } from "./client";
export async function createFamily(name:string):Promise<string>{const {data,error}=await requireSupabase().rpc("create_family",{p_name:name});if(error)throw error;return data as string;}
export async function joinFamily(inviteCode:string):Promise<string>{const {data,error}=await requireSupabase().rpc("join_family",{p_invite_code:inviteCode});if(error)throw error;return data as string;}
export type Family={id:string;name:string;invite_code:string;created_by:string;created_at:string};
export async function listMyFamilies():Promise<Family[]>{const {data,error}=await requireSupabase().from("families").select("id,name,invite_code,created_by,created_at").order("created_at",{ascending:true});if(error)throw error;return(data??[]) as Family[];}
