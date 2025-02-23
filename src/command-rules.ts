import {
  type command_type,
  parse_command_type,
} from "schemata/dist/generated/command_type";

import { type event_type } from "schemata/dist/generated/event_type";
import { type object_type } from "schemata/dist/generated/object_type";
import { parse_object_type } from "schemata/generated/object_type";

type fetch_func<k> = {
  type: k;
  id: string;
  sk: (v: object_val<k>) => command_outcome;
  fk: () => command_outcome;
};

type fetch_desc = fetch_func<object_type["type"]>;
type object_val<T> = object_type extends { type: T; value: infer v }
  ? v
  : never;

function fetch<T extends object_type["type"]>(
  type: T,
  id: string,
  sk: (val: object_val<T>) => command_outcome
): command_outcome {
  return {
    type: "fetch",
    desc: {
      type,
      id,
      sk: (v) => sk(v as any),
      fk: () => ({ type: "failed", reason: "not found" }),
    },
  };
}

type command_outcome =
  | { type: "fetch"; desc: fetch_desc }
  | terminal_command_outcome;
type terminal_command_outcome =
  | { type: "succeeded"; events: event_type[] }
  | { type: "failed"; reason: string };

type dispatch<k extends command_type["type"]> = (
  args: (command_type & { type: k })["value"]
) => command_outcome;

type command_rules = {
  [k in command_type["type"]]: <R>(inspect: inspector<k, R>) => R;
};

type inspector<T extends command_type["type"], R> = (args: {
  handler: dispatch<T>;
}) => R;

type Command<T extends command_type["type"]> = <R>(
  inspector: inspector<T, R>
) => R;

function Command<T extends command_type["type"]>(args: {
  handler: dispatch<T>;
}) {
  return <R>(inspect: inspector<T, R>) => inspect(args);
}

const command_rules: command_rules = {
  register: Command({
    handler: ({ user_id, email, salted_hash }) => ({
      type: "succeeded",
      events: [
        { type: "user_registered", value: { user_id, email, salted_hash } },
      ],
    }),
  }),
  change_email: Command({
    handler: () => ({ type: "failed" as const, reason: "not implemented" }),
  }),
};

const e = parse_command_type({ type: "register" });
const insp = command_rules[e.type];
const out = insp(({ handler }) => handler(e.value as any));

function fetch_object(type: string, id: string) {}

function f(out: command_outcome): terminal_command_outcome {
  switch (out.type) {
    case "fetch": {
      const { type, id, sk, fk } = out.desc;
      const o = parse_object_type(fetch_object(type, id));
      if (o.type === type) {
        return f(sk(o.value));
      } else {
        return f(fk());
      }
    }
    case "succeeded":
    case "failed":
      return out;
  }
}

f(out);
