import assert from "assert";
import axios from "axios";
import {
  process_command,
  type terminal_command_outcome,
} from "./command-rules.ts";
import { sleep } from "./sleep.ts";
import { type event_type } from "schemata/generated/event_type";

async function fetch_event_t(): Promise<number> {
  while (true) {
    try {
      const res = await axios.get("http://event-db:3000/event-apis/event-t");
      if (typeof res.data === "number") {
        return res.data;
      }
      throw new Error(`result is not a number`);
    } catch (error: any) {
      console.error(error);
      await sleep(1000);
    }
  }
}

async function reducers_catchup(event_t: number) {
  const reducers = ["object-reducer"];
  while (true) {
    try {
      await Promise.all(
        reducers.map((reducer) =>
          axios.get(`http://${reducer}:3000/object-apis/wait-t?t=${event_t}`)
        )
      );
      return;
    } catch (error) {
      console.error(error);
    }
  }
}

async function fetch_status_t(): Promise<number> {
  while (true) {
    try {
      const res = await axios.get("http://event-db:3000/event-apis/status-t");
      if (typeof res.data === "number") {
        return res.data;
      }
      throw new Error(`result is not a number`);
    } catch (error: any) {
      console.error(error);
      await sleep(1000);
    }
  }
}

type queued_command = {
  command_uuid: string;
  command_type: string;
  command_data: any;
  command_date: string;
  scheduled_for: string;
  status_t: string;
};

async function fetch_pending_commands(): Promise<queued_command[]> {
  while (true) {
    try {
      const res = await axios.get(
        "http://event-db:3000/event-apis/pending-commands"
      );
      return res.data as any as queued_command[];
    } catch (error: any) {
      console.error(error);
      await sleep(1000);
    }
  }
}

async function poll_command_queue(status_t: number): Promise<void> {
  while (true) {
    try {
      await axios.get(
        `http://event-db:3000/event-apis/poll-status?status_t=${status_t}`
      );
      return;
    } catch (error: any) {
      console.error(error);
      await sleep(1000);
    }
  }
}

async function fail_command(command_uuid: string, reason: string) {
  while (true) {
    try {
      await axios.post(`http://event-db:3000/event-apis/fail-command`, {
        command_uuid,
        reason,
      });
      return { reprocess: false };
    } catch (error: any) {
      console.error(`could not fail command: ${error}`);
      await sleep(1000);
    }
  }
}

async function succeed_command(
  command_uuid: string,
  event_t: number,
  events: event_type[]
): Promise<{ reprocess: boolean }> {
  while (true) {
    try {
      const out = await axios.post(
        `http://event-db:3000/event-apis/succeed-command`,
        {
          command_uuid,
          event_t,
          events,
        },
        {
          validateStatus: (status) => status === 200 || status === 409,
        }
      );
      switch (out.status) {
        case 409:
          return { reprocess: true };
        case 200:
          return { reprocess: false };
        default:
          throw new Error(`unexpected ${out.status}`);
      }
    } catch (error: any) {
      console.error(`could not succeed command: ${error}`);
      await sleep(1000);
    }
  }
}

async function register_outcome(
  command: queued_command,
  outcome: terminal_command_outcome,
  event_t: number
): Promise<{ reprocess: boolean }> {
  switch (outcome.type) {
    case "failed": {
      return fail_command(command.command_uuid, outcome.reason);
    }
    case "succeeded": {
      return succeed_command(command.command_uuid, event_t, outcome.events);
    }
    default:
      const invalid: never = outcome;
      throw invalid;
  }
}

class Processor {
  private event_t: number | undefined = undefined;
  private pending_commands: queued_command[] = [];
  public async event_handled(event_t: number) {
    if (this.event_t === undefined) {
      this.event_t = event_t;
      await Promise.all(
        this.pending_commands.map((x) => this.process_command(x))
      );
      this.pending_commands = [];
    } else {
      assert(event_t === this.event_t + 1);
      this.event_t = event_t;
    }
  }

  public async enqueue_command(command: queued_command) {
    if (this.event_t === undefined) {
      this.pending_commands.push(command);
    } else {
      await this.process_command(command);
    }
  }

  public async process_command(command: queued_command): Promise<void> {
    const event_t = this.event_t;
    assert(event_t !== undefined);
    try {
      console.log(command);
      const outcome = await process_command({
        type: command.command_type,
        data: command.command_data,
      });
      console.log(outcome);
      const { reprocess } = await register_outcome(
        command,
        outcome,
        event_t + 1
      );
      console.log({ reprocess });
    } catch (error: any) {
      console.error(`error while processing command`);
      console.error(error);
      await sleep(100);
      return this.process_command(command);
    }
  }
}

const processor = new Processor();

async function poll_commands() {
  let status_t = await fetch_status_t();
  const queue = await fetch_pending_commands();
  console.log(queue);
  await Promise.all(queue.map((x) => processor.enqueue_command(x)));
  while (true) {
    status_t += 1;
    await poll_command_queue(status_t);
    const queue = await fetch_pending_commands();
    await Promise.all(queue.map((x) => processor.enqueue_command(x)));
  }
}

export async function start_processing() {
  poll_commands();
  let event_t = await fetch_event_t();
  while (true) {
    console.log({ waiting_for_reducers: event_t });
    await reducers_catchup(event_t);
    console.log({ reducers_at: event_t });
    await processor.event_handled(event_t);
    event_t += 1;
  }
}
