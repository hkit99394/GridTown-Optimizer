type CliMain = () => void | Promise<void>;
type CliErrorFormatter = (error: unknown) => void;

function writeDefaultCliError(error: unknown): void {
  console.error(error);
}

export function runCliMain(run: CliMain, writeError: CliErrorFormatter = writeDefaultCliError): void {
  const fail = (error: unknown) => {
    writeError(error);
    process.exitCode = 1;
  };

  try {
    const result = run();
    if (result !== undefined) {
      void result.catch(fail);
    }
  } catch (error) {
    fail(error);
  }
}
