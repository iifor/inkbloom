// Command import-world loads a legacy save into a database initialized with migration 001.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"inkbloom/internal/save"
)

func run() error {
	if len(os.Args) != 2 || os.Getenv("DATABASE_URL") == "" {
		return fmt.Errorf("set DATABASE_URL and run import-world <world.json>")
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		return err
	}
	db, err := sql.Open("pgx", os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	return save.Import(ctx, db, data)
}
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
