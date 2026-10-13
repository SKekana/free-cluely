import { z } from "zod"
import type { ProblemInfo } from "./contracts"

export const extractedProblemSchema = z.object({
  problem_statement: z.string(), context: z.string(),
  suggested_responses: z.array(z.string()), reasoning: z.string()
})
export const solutionSchema = z.object({ solution: z.object({
  code: z.string(), thoughts: z.array(z.string()), time_complexity: z.string(), space_complexity: z.string(),
  problem_statement: z.string(), context: z.string(), suggested_responses: z.array(z.string()), reasoning: z.string()
}) })
export function jsonSchema(schema: z.ZodType): unknown {
  const { $schema: _version, ...result } = z.toJSONSchema(schema)
  return result
}
export function problemFromText(text: string, subtype = "text"): ProblemInfo {
  return {
    problem_statement: text, input_format: { description: "Captured context", parameters: [] },
    output_format: { description: "Assistant analysis", type: "string", subtype },
    complexity: { time: "N/A", space: "N/A" }, test_cases: [], validation_type: "manual", difficulty: "custom"
  }
}
