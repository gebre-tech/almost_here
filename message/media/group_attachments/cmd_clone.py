import os

def list_files():
    for file in os.listdir('.'):
        print(file)

def change_directory(path):
    try:
        os.chdir(path)
        print(f"Changed directory to {path}")
    except FileNotFoundError:
        print(f"Directory {path} not found")

def show_current_directory():
    print(os.getcwd())

def main():
    while True:
        command = input("cmd> ").strip().split()
        if not command:
            continue
        if command[0] == 'exit':
            break
        elif command[0] == 'ls':
            list_files()
        elif command[0] == 'cd' and len(command) > 1:
            change_directory(command[1])
        elif command[0] == 'pwd':
            show_current_directory()
        else:
            print(f"Unknown command: {command[0]}")

if __name__ == "__main__":
    main()
