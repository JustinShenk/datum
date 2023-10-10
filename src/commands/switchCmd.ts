import { Argv } from "yargs";
import { occurArgs, OccurCmdArgs } from "./occurCmd";
import { EitherDocument } from "../documentControl/DatumDocument";
import { handleDataArgs } from "../input/dataArgs";
import { handleTimeArgs } from "../input/timeArgs";
import { connectDb } from "../auth/connectDb";
import { flexiblePositional } from "../input/flexiblePositional";
import { getLastState } from "../state/findLastState";
import { addIdAndMetadata } from "../meta/addIdAndMetadata";
import { primitiveUndo } from "../undo/primitiveUndo";
import { addDoc } from "../documentControl/addDoc";
import { updateLastDocsRef } from "../documentControl/lastDocs";

export const command = [
  "switch <field> <state> [duration] [data..]",
  "switch --moment <field> <state> [data..]",
];
export const desc = "switch states of a given field";

export function builder(yargs: Argv): Argv {
  return occurArgs(yargs)
    .positional("state", {
      describe: "the state to switch to",
      type: "string",
      nargs: 1,
    })
    .options({
      "last-state": {
        describe: "manually specify the last state being transitioned out of",
        nargs: 1,
        // TODO: add alias l here after switching lenient to strict
      },
    });
}

export type SwitchCmdArgs = OccurCmdArgs & {
  state: string | boolean | null;
  lastState?: string | boolean | null;
};

export async function switchCmd(args: SwitchCmdArgs): Promise<EitherDocument> {
  const db = await connectDb(args);
  flexiblePositional(args, "duration", !args.moment && "optional", "dur");
  flexiblePositional(args, "state", "required");
  flexiblePositional(args, "field", !args.fieldless && "required");
  const payloadData = handleDataArgs(args);

  const { timeStr: occurTime, utcOffset } = handleTimeArgs(args);
  if (occurTime !== undefined) {
    payloadData.occurTime = occurTime;
    payloadData.occurUtcOffset = utcOffset;
  }

  payloadData.lastState = await getLastState({
    db,
    field: payloadData.field,
    lastState: args.lastState,
    time: occurTime,
  });

  const payload = addIdAndMetadata(payloadData, args);
  await updateLastDocsRef(db, payload._id);

  const { undo, forceUndo } = args;
  if (undo || forceUndo) {
    return await primitiveUndo({
      db,
      payload,
      force: forceUndo,
      outputArgs: args,
    });
  }

  const conflictStrategy = args.conflict ?? (args.merge ? "merge" : undefined);
  const doc = await addDoc({
    db,
    payload,
    conflictStrategy,
    outputArgs: args,
  });

  // if addDoc has changed the id (e.g. because it relies on the modifiyTime), update lastDocRef again
  // TODO: if changing lastDoc to history may need to change this to overwrite first update
  if (doc._id !== payload._id) {
    await updateLastDocsRef(db, doc._id);
  }

  return doc;
}
