import { type object_type } from "schemata/generated/object_type";

export type objects = {
  [k in object_type["type"]]: (object_type & { type: k })["data"];
};
