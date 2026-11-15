# Launch the Fruispect process supervisor.
import multiprocessing as mp
from app.runtime.supervisor import main


if __name__ == '__main__':
    mp.freeze_support()
    main()
