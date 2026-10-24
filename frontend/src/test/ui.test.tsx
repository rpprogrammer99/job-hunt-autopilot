import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dialog, ConfirmDialog } from "../components/ui/Dialog";
import { DropdownMenu, MenuItem } from "../components/ui/DropdownMenu";
import { Pagination } from "../components/ui/Feedback";
import { ToastProvider, useToast } from "../components/ui/Toast";

describe("Dialog", () => {
  it("renders when open and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="My Dialog" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "My Dialog" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("does not render when closed", () => {
    render(
      <Dialog open={false} title="Hidden" onClose={() => {}}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete?"
        message="Sure?"
        confirmLabel="Delete"
        danger
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe("DropdownMenu", () => {
  it("opens on trigger and fires item click", () => {
    const onClick = vi.fn();
    render(
      <DropdownMenu
        trigger={({ toggle }) => (
          <button onClick={toggle}>Open</button>
        )}
      >
        {(close) => (
          <MenuItem onClick={() => { onClick(); close(); }}>Do it</MenuItem>
        )}
      </DropdownMenu>,
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Do it"));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("Pagination", () => {
  it("disables prev on first page and calls onPage for next", () => {
    const onPage = vi.fn();
    render(<Pagination page={1} pageSize={10} total={25} onPage={onPage} />);
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(onPage).toHaveBeenCalledWith(2);
  });
  it("shows the item range", () => {
    render(<Pagination page={1} pageSize={10} total={25} onPage={() => {}} />);
    expect(screen.getByText("1–10 of 25")).toBeInTheDocument();
  });
});

describe("Toast", () => {
  function Trigger() {
    const toast = useToast();
    return <button onClick={() => toast.success("Saved!")}>Fire</button>;
  }
  it("shows a toast message on action", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Fire"));
    expect(screen.getByText("Saved!")).toBeInTheDocument();
  });
});
