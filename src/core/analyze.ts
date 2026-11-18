import { Diagnostic, diagnosticFromError } from "./diagnostics";
import { ReaderError } from "./errors";
import { parseAll } from './reader';

export function analyze(source: string): Diagnostic[] {
    try { 
        parseAll(source);
        return [];
    }
    catch (error) {
        if (error instanceof ReaderError)
            return [diagnosticFromError(error)];
        throw error;
    }
}