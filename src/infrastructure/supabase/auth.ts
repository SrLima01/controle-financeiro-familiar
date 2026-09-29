import type { Session, User } from "@supabase/supabase-js";
import { requireSupabase } from "./client";
export type AuthState={user:User|null;session:Session|null};
export async function getAuthState():Promise<AuthState>{const {data,error}=await requireSupabase().auth.getSession();if(error)throw error;return{user:data.session?.user??null,session:data.session??null};}
export async function signUpWithEmail(email:string,password:string){const {data,error}=await requireSupabase().auth.signUp({email,password});if(error)throw error;return data;}
export async function signInWithEmail(email:string,password:string){const {data,error}=await requireSupabase().auth.signInWithPassword({email,password});if(error)throw error;return data;}
export async function signOut(){const {error}=await requireSupabase().auth.signOut();if(error)throw error;}
export function onAuthStateChange(callback:(state:AuthState)=>void){return requireSupabase().auth.onAuthStateChange((_event,session)=>callback({user:session?.user??null,session}));}
