import { z } from "zod";
export declare const ListFilesSchema: z.ZodObject<{
    repo: z.ZodString;
    directory: z.ZodString;
}, z.core.$strip>;
export type ListFilesInput = z.infer<typeof ListFilesSchema>;
export declare function listFiles(input: ListFilesInput): Promise<string>;
