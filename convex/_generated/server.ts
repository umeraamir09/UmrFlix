import {
  queryGeneric,
  mutationGeneric,
  GenericQueryCtx,
  GenericMutationCtx,
  DataModelFromSchemaDefinition,
} from "convex/server"
import schema from "../schema"

export type DataModel = DataModelFromSchemaDefinition<typeof schema>

export type QueryCtx = GenericQueryCtx<DataModel>
export type MutationCtx = GenericMutationCtx<DataModel>

export const query = queryGeneric as <Output>(
  func: {
    args?: any
    handler: (ctx: QueryCtx, args: any) => Promise<Output>
  }
) => any

export const mutation = mutationGeneric as <Output>(
  func: {
    args?: any
    handler: (ctx: MutationCtx, args: any) => Promise<Output>
  }
) => any
