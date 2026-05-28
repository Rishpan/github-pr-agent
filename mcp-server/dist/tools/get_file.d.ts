import { z } from "zod";
export declare const GetFileSchema: z.ZodObject<{
    repo: z.ZodString;
    path: z.ZodString;
}, z.core.$strip>;
export type GetFileInput = z.infer<typeof GetFileSchema>;
export declare function getFile(input: GetFileInput): Promise<string>;
